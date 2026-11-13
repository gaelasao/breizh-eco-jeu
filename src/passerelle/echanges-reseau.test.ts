/**
 * Échanges entre agents de deux entreprises, côté jeu (le lien réseau et ses deux routes), contre un réseau simulé qui
 * répond dans la forme de l'agent de Breizhcosystem (protocole A2A 1.0, liaison HTTP+JSON) :
 * - une demande de prix est relue avant de partir, et ne part que par ce qu'une clé a le droit de faire ;
 * - chaque réponse est relue avant usage (textes, chiffres, dates) ; une adresse écrite par le réseau n'est jamais reprise ;
 * - un échange d'un genre ou d'un statut plus récent que le jeu reste lisible ;
 * - le jeu ne valide jamais une proposition : aucune méthode, aucune route, aucune requête ne le tente ;
 * - une clé d'API du jeu ne demande pas de prix (décision réservée à une personne, comme les autres engagements du réseau).
 * Le même parcours contre le vrai serveur : bout-en-bout-reseau.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { LienNexus } from './lien-nexus.ts';
import { ErreurApi } from './monde.ts';
import { chiffreurEphemere } from './stockage.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// fausse clé d'organisation du réseau, construite à l'exécution
const NX = ['nx', 'k'.repeat(43)].join('_');
const ADRESSE = 'http://127.0.0.1:4180';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
interface Recu { m: string; chemin: string; q: URLSearchParams; corps: Json; entetes: Record<string, string> }

/** Réseau simulé : la liaison, les droits, et l'agent de l'entreprise (`/a2a`), dont chaque essai règle la réponse. */
function reseauSimule() {
  const recu: Recu[] = [];
  let confirme = false;
  const s = {
    recu,
    confirmer: () => { confirme = true; },
    /** Réponse de l'agent à la prochaine requête sous `/a2a`. */
    agent: (_r: Recu): Response => Response.json({ tasks: [], nextPageToken: '', pageSize: 100, totalSize: 0 }),
    f: (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = new URL(String(url));
      const r: Recu = { m: init?.method ?? 'GET', chemin: u.pathname, q: u.searchParams, corps: init?.body ? JSON.parse(String(init.body)) : null, entetes: (init?.headers ?? {}) as Record<string, string> };
      recu.push(r);
      if (u.pathname === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://reseau.test/relier?code=ABCD-2345', expire: new Date(Date.now() + 600_000).toISOString() });
      if (u.pathname === '/v0/liaison/retrait') return Response.json(confirme ? { statut: 'confirmee', cle: NX, organisation: 'Menuiserie Kerlann' } : { statut: 'en_attente' });
      if (u.pathname.startsWith('/a2a/')) return s.agent(r);
      if (r.entetes.authorization !== `Bearer ${NX}`) return Response.json({ erreur: 'cle_invalide' }, { status: 401 });
      if (u.pathname === '/v0/droits') return Response.json({ orgId: ID(1), plan: 'active', etatAbonnement: 'actif', actifJusquau: null, capacites: ['agent_achat'], verifieLe: new Date().toISOString() });
      if (u.pathname === '/v0/partage') return Response.json({ categories: [] });
      return Response.json({ erreur: 'introuvable' }, { status: 404 });
    }) as typeof fetch,
  };
  return s;
}

interface OptionsTache {
  statut?: unknown; etat?: unknown; cote?: unknown; attend?: unknown; titre?: unknown; texte?: unknown; le?: unknown;
  proposition?: unknown; commande?: unknown; demande?: unknown; meta?: Record<string, unknown>;
}
/** Une tâche telle que la rend l'agent du réseau : un échange vu d'un côté. */
function tache(n: number, o: OptionsTache = {}): Json {
  const id = ID(n);
  const donnees = (d: unknown) => ({ data: d, mediaType: 'application/json' });
  return {
    id, contextId: ID(1000 + n),
    status: { state: o.etat ?? 'TASK_STATE_AUTH_REQUIRED', timestamp: o.le ?? '2026-11-12T09:00:00.000Z',
      message: { messageId: `${id}/etat-1`, role: 'ROLE_AGENT', taskId: id, contextId: ID(1000 + n), parts: [{ text: o.texte ?? 'Demande transmise au vendeur.', mediaType: 'text/plain' }] } },
    artifacts: [
      ...(o.proposition !== undefined ? [{ artifactId: 'proposition', name: 'Proposition du vendeur', description: 'N’engage personne.', parts: [donnees(o.proposition)] }] : []),
      ...(o.commande !== undefined ? [{ artifactId: 'commande', name: 'Commande', description: 'À confirmer par le vendeur.', parts: [donnees(o.commande)] }] : []),
    ],
    history: [{ messageId: `${id}/demande`, role: 'ROLE_USER', taskId: id, parts: [donnees(o.demande ?? { action: 'demander-prix', stockId: ID(11), quantite: 4, prixSouhaite: 38 })] }],
    metadata: { breizhcosystem: { statut: o.statut ?? 'attente_vendeur', cote: o.cote ?? 'acheteur', attend: o.attend ?? 'personne_vendeur', stockId: ID(11), titre: o.titre ?? 'Plateaux de chêne 27 mm',
      acheteurId: ID(1), vendeurId: ID(2), validation: 'https://pirate.test/echanges', ...o.meta } },
  };
}
const PROPOSITION = { echangeId: ID(71), stockId: ID(11), titre: 'Plateaux de chêne 27 mm', unite: 'plateau', quantite: 4, prixUnitaireHt: 38, totalHt: 152, devise: 'EUR', valableJusquau: '2026-11-17T09:00:00.000Z', reponduPar: 'regle', engage: false };
/** Refus dans la forme du protocole (AIP-193, google.rpc.ErrorInfo). */
const refusAgent = (statut: number, raison: unknown, message: unknown = 'Refus.') => Response.json({ error: { code: statut, status: 'X', message,
  details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: raison, domain: 'reseau.test', metadata: {} }] } }, { status: statut });

async function relier(lien: LienNexus, n: ReturnType<typeof reseauSimule>) {
  await lien.reglerAdresse(ADRESSE);
  await lien.demarrerLiaison();
  n.confirmer();
  assert.equal((await lien.suivreLiaison()).statut, 'reliee');
}
async function monter() {
  const n = reseauSimule();
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: n.f, changement: () => { /* rien à enregistrer ici */ }, urlParDefaut: null });
  await relier(lien, n);
  return { n, lien };
}
const refus = (statut: number, code: string, message?: RegExp) => (e: unknown) => e instanceof ErreurApi && e.statut === statut && e.code === code && (!message || message.test(e.message));
/** Ce que le réseau ouvre à une clé chez son agent, et rien d'autre : envoyer une demande de prix, lister les tâches. */
function seulementPermis(recu: readonly Recu[]) {
  assert.ok(!recu.some((r) => r.chemin.startsWith('/v0/echanges')), 'les routes des échanges réservées aux personnes ne sont jamais appelées');
  for (const r of recu.filter((x) => x.chemin.startsWith('/a2a'))) {
    assert.ok((r.m === 'POST' && r.chemin === '/a2a/message:send') || (r.m === 'GET' && r.chemin === '/a2a/tasks'), `${r.m} ${r.chemin}`);
    if (r.m !== 'POST') continue;
    assert.equal(r.corps.message.parts[0].data.action, 'demander-prix', 'jamais « valider », « accepter », « repondre » ni « confirmer »');
    assert.ok(!('taskId' in r.corps.message), 'jamais la suite d’une tâche : une demande neuve');
  }
}

test('demander un prix : saisie relue avant tout envoi ; la demande part vers l’agent de l’entreprise, avec la même clé à chaque nouvel essai', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { n, lien } = await monter();
    n.agent = () => Response.json({ task: tache(71, { statut: 'proposee', attend: 'personne_acheteur', proposition: PROPOSITION }) });
    const avant = n.recu.length;
    for (const [saisie, code] of [
      [{ stockId: '../../v0/echanges/valider', quantite: 1 }, 'identifiant_invalide'], [{ quantite: 1 }, 'identifiant_invalide'], [null, 'identifiant_invalide'],
      [{ stockId: ID(11) }, 'quantite_invalide'], [{ stockId: ID(11), quantite: 0 }, 'quantite_invalide'], [{ stockId: ID(11), quantite: '4' }, 'quantite_invalide'], [{ stockId: ID(11), quantite: 2_000_000 }, 'quantite_invalide'],
      [{ stockId: ID(11), quantite: 4, prixSouhaite: -1 }, 'prix_invalide'], [{ stockId: ID(11), quantite: 4, prixSouhaite: 'pas cher' }, 'prix_invalide'], [{ stockId: ID(11), quantite: 4, prixSouhaite: 0 }, 'prix_invalide'],
      [{ stockId: ID(11), quantite: 4, departement: 'Finistère' }, 'departement_invalide'],
    ] as const) await assert.rejects(lien.demanderPrix(saisie), refus(400, code), JSON.stringify(saisie));
    assert.equal(n.recu.length, avant, 'rien n’est parti vers le réseau');

    const r = await lien.demanderPrix({ stockId: ID(11), quantite: 4, prixSouhaite: 38, departement: '2a', cle: ID(77), action: 'valider', taskId: ID(5), intrus: true });
    const envoi = n.recu.at(-1) as Recu;
    assert.deepEqual([envoi.m, envoi.chemin, envoi.q.toString()], ['POST', '/a2a/message:send', '']);
    assert.deepEqual([envoi.entetes['a2a-version'], envoi.entetes.authorization, envoi.entetes['content-type']], ['1.0', `Bearer ${NX}`, 'application/json']);
    // seuls les champs de la demande partent : ni l'action glissée dans la saisie, ni un identifiant de tâche
    assert.deepEqual(envoi.corps, { message: { messageId: ID(77), role: 'ROLE_USER', parts: [{ data: { action: 'demander-prix', stockId: ID(11), quantite: 4, prixSouhaite: 38, departement: '2A' }, mediaType: 'application/json' }] } });
    assert.deepEqual([r.echange.id, r.echange.statut, r.echange.attend], [ID(71), 'proposee', 'vous']);

    // nouvel essai de la même demande (délai dépassé) : même identifiant de message, le réseau rend le même échange
    await lien.demanderPrix({ stockId: ID(11), quantite: 4, prixSouhaite: 38, departement: '2a', cle: ID(77) });
    assert.equal(n.recu.at(-1)?.corps.message.messageId, ID(77));
    // sans clé lisible : un identifiant neuf à chaque demande ; prix souhaité et département facultatifs
    await lien.demanderPrix({ stockId: ID(11), quantite: 2.5, cle: 'pas une clé', prixSouhaite: '', departement: null });
    const un = n.recu.at(-1)?.corps.message;
    await lien.demanderPrix({ stockId: ID(11), quantite: 2.5 });
    const deux = n.recu.at(-1)?.corps.message;
    assert.match(un.messageId, UUID);
    assert.match(deux.messageId, UUID);
    assert.notEqual(un.messageId, deux.messageId);
    assert.deepEqual(deux.parts[0].data, { action: 'demander-prix', stockId: ID(11), quantite: 2.5 });
    assert.ok(!n.recu.some((x) => `${x.chemin}?${x.q}`.includes('nx_')), 'la clé n’est jamais dans une adresse');
    seulementPermis(n.recu);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('réponse de l’agent relue avant usage : textes nettoyés et bornés, chiffres vérifiés, total recalculé, adresse écrite par le réseau jamais reprise', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { n, lien } = await monter();
    const demander = () => lien.demanderPrix({ stockId: ID(11), quantite: 4 });
    n.agent = () => Response.json({ task: tache(71, {
      statut: 'proposee', attend: 'personne_acheteur', titre: `Chêne‮\n${'x'.repeat(400)}`, texte: `Proposition du vendeur.\r\nValidez sur https://pirate.test/echanges ${'y'.repeat(600)}`,
      proposition: { ...PROPOSITION, totalHt: 1, lien: 'https://pirate.test/payer', engage: true },
    }) });
    const r = await demander();
    assert.equal(r.page, `${ADRESSE}/echanges`, 'où valider : la page du réseau à l’adresse réglée dans le jeu');
    assert.deepEqual(Object.keys(r.echange).sort(), ['attend', 'avancement', 'commande', 'cote', 'id', 'majLe', 'message', 'prixSouhaite', 'proposition', 'quantite', 'statut', 'stockId', 'titre'],
      'rien d’autre ne remonte (ni identifiants des entreprises, ni contexte, ni adresse)');
    assert.ok(!JSON.stringify({ ...r, echange: { ...r.echange, message: null } }).includes('pirate.test'), 'aucune adresse du réseau hors de sa phrase, qui reste un texte');
    assert.equal(r.echange.titre.length, 200);
    assert.ok(!/[\u0000-\u001f‮]/.test(r.echange.titre + r.echange.message), 'ni retour à la ligne ni caractère de contrôle');
    assert.equal(r.echange.message?.length, 400);
    assert.deepEqual(r.echange.proposition, { quantite: 4, prixUnitaire: 38, total: 152, valableJusquau: '2026-11-17T09:00:00.000Z', par: 'regle' }, 'total = quantité × prix, pas celui annoncé');
    assert.deepEqual([r.echange.quantite, r.echange.prixSouhaite, r.echange.stockId, r.echange.majLe], [4, 38, ID(11), '2026-11-12T09:00:00.000Z']);

    // proposition illisible : pas de chiffres plutôt que des chiffres faux
    for (const p of [{ ...PROPOSITION, quantite: -4 }, { ...PROPOSITION, quantite: 1e9 }, { ...PROPOSITION, prixUnitaireHt: 'gratuit' }, { ...PROPOSITION, prixUnitaireHt: -1 }, { quantite: 4 }, 'quatre à 38 euros', null]) {
      n.agent = () => Response.json({ task: tache(71, { statut: 'proposee', proposition: p }) });
      assert.equal((await demander()).echange.proposition, null, JSON.stringify(p));
    }
    n.agent = () => Response.json({ task: tache(71, { statut: 'proposee', proposition: { ...PROPOSITION, quantite: 3, prixUnitaireHt: 9.99, valableJusquau: 'bientôt', reponduPar: 'un robot' }, le: 'hier', demande: { quantite: 'beaucoup', prixSouhaite: -3 } }) });
    const flou = (await demander()).echange;
    assert.deepEqual(flou.proposition, { quantite: 3, prixUnitaire: 9.99, total: 29.97, valableJusquau: null, par: null });
    assert.deepEqual([flou.quantite, flou.prixSouhaite, flou.majLe], [null, null, null]);

    // commande née d'une validation (faite par une personne, sur le réseau) : référence et statut vérifiés
    n.agent = () => Response.json({ task: tache(71, { statut: 'acceptee', etat: 'TASK_STATE_COMPLETED', attend: null, proposition: PROPOSITION, commande: { commandeId: ID(31), reference: 'NX-7K2Q9A', statut: 'validee', montantHt: 152 } }) });
    assert.deepEqual((await demander()).echange.commande, { reference: 'NX-7K2Q9A', statut: 'validee' });
    n.agent = () => Response.json({ task: tache(71, { statut: 'acceptee', etat: 'TASK_STATE_COMPLETED', commande: { reference: '<b>NX</b>', statut: 'payee_par_le_reseau' } }) });
    assert.deepEqual((await demander()).echange.commande, { reference: null, statut: null });

    // tâche illisible (ni identifiant, ni état), ou réponse sans tâche : rien n'est affiché, et la personne sait quoi regarder
    for (const t of [null, 'ok', {}, { ...tache(71), id: 'pas-un-uuid' }, { ...tache(71), status: { state: 'état libre' } }, { ...tache(71), status: null }]) {
      n.agent = () => Response.json({ task: t });
      await assert.rejects(demander(), refus(502, 'nexus_reponse', /peut-être partie.*Échanges en cours/), JSON.stringify(t));
    }
    n.agent = () => Response.json({ message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ text: 'Cet agent suit des règles fixes.' }] } });
    await assert.rejects(demander(), refus(502, 'nexus_reponse'));
    seulementPermis(n.recu);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('liste des échanges : toutes les pages (nombre borné), sans doublon ; ce qui attend l’entreprise d’abord, terminés limités ; genres et statuts plus récents que le jeu gardés', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { n, lien } = await monter();
    const pages: Record<string, Json> = {
      '': { tasks: [
        tache(1, { statut: 'acceptee', etat: 'TASK_STATE_COMPLETED', attend: null, proposition: PROPOSITION, commande: { reference: 'NX-7K2Q9A', statut: 'confirmee' } }),
        tache(2, { statut: 'attente_vendeur' }),
        tache(3, { statut: 'proposee', attend: 'personne_acheteur', proposition: PROPOSITION }),
        { id: 'illisible' }, 'pas une tâche', null,
      ], nextPageToken: 'page-2', pageSize: 100, totalSize: 7 },
      'page-2': { tasks: [
        tache(3, { statut: 'annulee', etat: 'TASK_STATE_CANCELED' }), // déjà vu à la page 1 : la première lecture reste
        // genre d'échange plus récent que le jeu : pas de stock, statut et artefact inconnus, la tâche attend une réponse de l'acheteur
        tache(4, { statut: 'contre_proposee', etat: 'TASK_STATE_INPUT_REQUIRED', attend: 'personne_acheteur', titre: 'Pose de parquet', texte: 'Contre-proposition du vendeur : à voir sur Breizhcosystem.',
          meta: { stockId: undefined, catalogueId: ID(12), genre: 'catalogue' }, demande: { action: 'demander-devis', catalogueId: ID(12) }, proposition: undefined }),
        tache(5, { statut: 'attente_vendeur', cote: 'vendeur' }),
        tache(6, { statut: 'en_negociation', etat: 'TASK_STATE_NEGOTIATING', attend: 'les deux' }),
        tache(7, { statut: 'cloturee', etat: 'TASK_STATE_REJECTED', attend: null }),
        // statut connu : c'est lui qui dit où en est l'échange, même si l'état ou « attend » le contredisent
        tache(8, { statut: 'expiree', etat: 'TASK_STATE_AUTH_REQUIRED', attend: 'personne_acheteur' }),
      ], nextPageToken: '', pageSize: 100, totalSize: 7 },
    };
    n.agent = (r) => Response.json(pages[r.q.get('pageToken') ?? ''] ?? { tasks: [] });
    const avant = n.recu.length;
    const l = await lien.echanges();
    const appels = n.recu.slice(avant);
    assert.deepEqual(appels.map((r) => [r.m, r.chemin, r.q.toString(), r.corps, r.entetes['a2a-version'], r.entetes.authorization, r.entetes['content-type']]), [
      ['GET', '/a2a/tasks', 'pageSize=100&includeArtifacts=true', null, '1.0', `Bearer ${NX}`, undefined],
      ['GET', '/a2a/tasks', 'pageSize=100&includeArtifacts=true&pageToken=page-2', null, '1.0', `Bearer ${NX}`, undefined],
    ]);
    assert.equal(l.page, `${ADRESSE}/echanges`);
    assert.deepEqual(l.echanges.map((e) => [e.id, e.cote, e.statut, e.avancement, e.attend]), [
      [ID(3), 'acheteur', 'proposee', 'attend_personne', 'vous'],
      [ID(4), 'acheteur', null, 'attend_personne', 'vous'],
      [ID(5), 'vendeur', 'attente_vendeur', 'attend_personne', 'vous'],
      [ID(2), 'acheteur', 'attente_vendeur', 'attend_personne', 'autre'],
      [ID(6), 'acheteur', null, 'en_cours', null],
      [ID(1), 'acheteur', 'acceptee', 'conclu', null],
      [ID(7), 'acheteur', null, 'refuse', null],
      [ID(8), 'acheteur', 'expiree', 'arrete', null],
    ]);
    const nouveau = l.echanges.find((e) => e.id === ID(4));
    assert.deepEqual([nouveau?.titre, nouveau?.stockId, nouveau?.quantite, nouveau?.proposition, nouveau?.message], ['Pose de parquet', null, null, null, 'Contre-proposition du vendeur : à voir sur Breizhcosystem.']);
    assert.deepEqual(l.echanges.find((e) => e.id === ID(1))?.commande, { reference: 'NX-7K2Q9A', statut: 'confirmee' });

    // beaucoup d'échanges terminés : les 20 premiers reçus (les plus récents) ; ceux qui sont en cours le sont tous
    n.agent = () => Response.json({ tasks: [...Array.from({ length: 30 }, (_, i) => tache(100 + i, { statut: 'annulee', etat: 'TASK_STATE_CANCELED' })), ...Array.from({ length: 30 }, (_, i) => tache(200 + i, { statut: 'attente_vendeur' }))], nextPageToken: '' });
    const beaucoup = (await lien.echanges()).echanges;
    assert.deepEqual([beaucoup.filter((e) => e.avancement === 'attend_personne').length, beaucoup.filter((e) => e.avancement === 'arrete').map((e) => e.id)], [30, Array.from({ length: 20 }, (_, i) => ID(100 + i))]);

    // un réseau qui annonce toujours une page de plus : 5 lectures, pas une de plus
    let lectures = 0;
    n.agent = () => Response.json({ tasks: [tache(300 + lectures++)], nextPageToken: 'encore' });
    assert.equal((await lien.echanges()).echanges.length, 5);
    assert.equal(lectures, 5);
    // jeton de page illisible, page vide ou réponse sans liste : on s'arrête là
    for (const reponse of [{ tasks: [tache(1)], nextPageToken: 'a b&c=d' }, { tasks: [tache(1)], nextPageToken: 'x'.repeat(201) }, { tasks: [tache(1)], nextPageToken: 42 }, { tasks: [], nextPageToken: 'encore' }, { tasks: 'aucune' }, null]) {
      lectures = 0;
      n.agent = () => { lectures++; return Response.json(reponse); };
      await lien.echanges();
      assert.equal(lectures, 1, JSON.stringify(reponse)?.slice(0, 60));
    }
    seulementPermis(n.recu);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('refus de l’agent : dits avec les codes de l’API ; offre payante en 402 ; réseau sans échanges reconnu ; suspension et clé révoquée comme partout ailleurs', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { n, lien } = await monter();
    const demander = () => lien.demanderPrix({ stockId: ID(11), quantite: 4 });
    n.agent = () => refusAgent(409, 'DEJA_EN_COURS', 'Une demande est déjà en cours pour ce stock : suivez-la ou annulez-la avant d’en refaire une.');
    await assert.rejects(demander(), refus(409, 'deja_en_cours', /^Une demande est déjà en cours pour ce stock/));
    n.agent = () => refusAgent(429, 'TROP_DE_DEMANDES', 'Beaucoup de demandes de prix aujourd’hui : reprenez demain.');
    await assert.rejects(demander(), refus(429, 'trop_de_demandes', /reprenez demain/));
    n.agent = () => refusAgent(404, 'INTROUVABLE', 'Ce stock n’est pas proposé sur le réseau (retiré, ou vendeur non vérifié).');
    await assert.rejects(demander(), refus(404, 'introuvable', /n’est pas proposé/));
    n.agent = () => refusAgent(403, 'VERIFICATION_REQUISE', 'Échanger entre agents : réservé aux entreprises vérifiées.');
    await assert.rejects(demander(), refus(403, 'verification_requise', /entreprises vérifiées/));
    // le protocole n'a pas de 402 : l'offre payante requise redevient le 402 que l'écran sait expliquer
    n.agent = () => refusAgent(403, 'OFFRE_ACTIVE_REQUISE', 'Fonction réservée à Breizhcosystem ACTIVE (29 € HT/mois, sans engagement).');
    await assert.rejects(demander(), refus(402, 'nexus_active_requis', /Breizhcosystem ACTIVE/));
    await assert.rejects(lien.echanges(), refus(402, 'nexus_active_requis'));
    // version du protocole refusée : un message pour une personne, pas celui écrit pour un outil
    n.agent = () => refusAgent(400, 'VERSION_NOT_SUPPORTED', 'Version 1.0 du protocole A2A non prise en charge : envoyez l’en-tête « A2A-Version: 2.0 ».');
    await assert.rejects(demander(), refus(502, 'echanges_version', /mettez Living Business à jour/));
    // panne du réseau, message démesuré, raison illisible
    n.agent = () => refusAgent(500, 'INTERNE', 'Erreur interne.');
    await assert.rejects(demander(), refus(502, 'interne'));
    n.agent = () => refusAgent(400, '<script>alert(1)</script>', `Refus\u0007\n${'z'.repeat(900)}`);
    await assert.rejects(demander(), (e: unknown) => e instanceof ErreurApi && e.statut === 400 && e.code === 'nexus_erreur' && e.message.length === 400 && !/[\u0000-\u001f]/.test(e.message));
    n.agent = () => refusAgent(400, 'REQUETE_INVALIDE', null);
    await assert.rejects(demander(), refus(400, 'requete_invalide', /^Breizhcosystem : erreur 400\.$/));

    // réseau d'avant les échanges entre agents : `/a2a` y est inconnu, et il le dit hors de la forme du protocole
    for (const ancienne of [() => Response.json({ erreur: 'introuvable' }, { status: 404 }), () => new Response('<h1>Introuvable</h1>', { status: 404, headers: { 'content-type': 'text/html' } }), () => Response.json({ erreur: 'methode' }, { status: 405 })]) {
      n.agent = ancienne;
      await assert.rejects(lien.echanges(), refus(404, 'echanges_indisponibles', /ne propose pas encore les échanges entre agents/));
      await assert.rejects(demander(), refus(404, 'echanges_indisponibles'));
    }

    // entreprise suspendue par l'éditeur : la clé est gardée ; un autre 401 ne délie pas ; seule une clé révoquée délie
    n.agent = () => refusAgent(403, 'ENTREPRISE_SUSPENDUE', 'Le compte de votre entreprise est suspendu : écrivez à l’équipe Breizhcosystem.');
    await assert.rejects(lien.echanges(), refus(409, 'nexus_suspendu', /liaison est conservée/));
    assert.equal(lien.relie, true);
    assert.match(String(lien.etat().suspendue?.message), /suspendu/);
    n.agent = () => refusAgent(401, 'CLE_REQUISE', 'Clé d’accès de l’entreprise attendue.');
    await assert.rejects(lien.echanges(), refus(502, 'cle_requise'));
    assert.equal(lien.relie, true);
    n.agent = () => Response.json({ tasks: [], nextPageToken: '' });
    assert.deepEqual((await lien.echanges()).echanges, []);
    assert.equal(lien.etat().suspendue, null, 'réponse normale : la suspension est levée');
    n.agent = () => refusAgent(401, 'CLE_INVALIDE', 'Clé d’accès inconnue, expirée ou révoquée.');
    await assert.rejects(lien.echanges(), refus(409, 'nexus_non_relie', /révoquée/));
    assert.equal(lien.relie, false, 'clé révoquée sur le réseau : le jeu oublie sa liaison');
    const avant = n.recu.length;
    await assert.rejects(demander(), refus(409, 'nexus_non_relie'));
    assert.equal(n.recu.length, avant, 'plus de clé : rien ne part');
    seulementPermis(n.recu);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('le jeu ne valide jamais une proposition : aucune méthode du lien réseau, aucune route du jeu ; demander un prix est réservé à une personne (jamais une clé d’API)', async () => {
  // le lien réseau n'offre que « demander » et « lister » pour les échanges
  const methodes = Object.getOwnPropertyNames(LienNexus.prototype);
  assert.deepEqual(methodes.filter((m) => /echange|prix/i.test(m)).sort(), ['demanderPrix', 'echanges']);

  const n = reseauSimule();
  process.env.LB_AUTORISER_LOCAL = '1';
  const app = await Application.creer({ fetch: n.f });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/v1`;
  try {
    await relier(app.nexus, n);
    n.agent = (r) => (r.m === 'POST' ? Response.json({ task: tache(71, { statut: 'proposee', attend: 'personne_acheteur', proposition: PROPOSITION }) }) : Response.json({ tasks: [tache(71, { statut: 'proposee', attend: 'personne_acheteur', proposition: PROPOSITION })], nextPageToken: '' }));
    const client = (autorisation: string | null = null) => {
      let cookie = '';
      return async (methode: string, chemin: string, corps?: unknown) => {
        const r = await fetch(base + chemin, { method: methode, headers: { ...(cookie ? { cookie } : {}), ...(autorisation ? { authorization: autorisation } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', ...(autorisation ? {} : { 'x-lb-requete': '1' }) } : {}) }, body: corps === undefined ? null : JSON.stringify(corps) });
        const sc = r.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0] as string;
        return { statut: r.status, json: (await r.json().catch(() => null)) as Json };
      };
    };
    // une personne qui administre : elle demande un prix, elle suit ; pour valider, le jeu lui donne la page du réseau
    const admin = client();
    assert.equal((await admin('POST', '/session', { profilId: 'dirigeante' })).statut, 200);
    const d = await admin('POST', '/nexus/echanges', { stockId: ID(11), quantite: 4, prixSouhaite: 38, cle: ID(77) });
    assert.deepEqual([d.statut, d.json.echange.id, d.json.echange.statut, d.json.echange.proposition.total, d.json.page], [200, ID(71), 'proposee', 152, `${ADRESSE}/echanges`]);
    assert.equal(n.recu.at(-1)?.corps.message.messageId, ID(77));
    const l = await admin('GET', '/nexus/echanges');
    assert.deepEqual([l.statut, l.json.echanges.map((e: Json) => [e.id, e.attend]), l.json.page], [200, [[ID(71), 'vous']], `${ADRESSE}/echanges`]);
    assert.deepEqual([(await admin('POST', '/nexus/echanges', { stockId: 'x', quantite: 4 })).statut, (await admin('POST', '/nexus/echanges', { stockId: ID(11), quantite: -1 })).json.erreur], [400, 'quantite_invalide']);
    // aucune route du jeu pour valider, répondre ou refuser un échange
    for (const geste of ['valider', 'repondre', 'refuser']) assert.equal((await admin('POST', `/nexus/echanges/${ID(71)}/${geste}`, {})).statut, 404, geste);
    for (const m of ['PUT', 'DELETE']) assert.equal((await admin(m, '/nexus/echanges', {})).statut, 404, m);

    // un profil qui n'administre pas : rien
    const terrain = client();
    await terrain('POST', '/session', { profilId: 'terrain' });
    assert.deepEqual([(await terrain('GET', '/nexus/echanges')).statut, (await terrain('POST', '/nexus/echanges', { stockId: ID(11), quantite: 4 })).statut], [403, 403]);

    // une clé d'API du jeu, même avec un profil administrateur : elle lit (comme les commandes), elle ne demande rien au réseau
    const cle = (await admin('POST', '/cles', { nom: 'Assistant', profilId: 'dirigeante' })).json;
    const parCle = client(`Bearer ${cle.jeton}`);
    const avant = n.recu.length;
    for (const [chemin, corps] of [['/nexus/echanges', { stockId: ID(11), quantite: 4 }], [`/nexus/echanges/${ID(71)}/valider`, {}], [`/nexus/echanges/${ID(71)}/refuser`, {}]] as const) {
      const r = await parCle('POST', chemin, corps);
      assert.deepEqual([r.statut, r.json.erreur], [403, 'session_requise'], chemin);
    }
    assert.equal(n.recu.length, avant, 'rien n’est parti vers le réseau');
    assert.equal((await parCle('GET', '/nexus/echanges')).statut, 200);
    seulementPermis(n.recu);
  } finally {
    delete process.env.LB_AUTORISER_LOCAL;
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});
