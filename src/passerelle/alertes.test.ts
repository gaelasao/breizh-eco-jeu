/**
 * Alertes en temps réel : branchement, message d'essai, filtres, regroupement, heures de silence, plafond par jour,
 * échec puis reprise, jeton invalide. Tout se joue contre un service SIMULÉ (`fetch` remplacé) : aucun appel réseau,
 * aucun compte réel, aucun jeton réel — ceux qui apparaissent ici sont fabriqués à l'exécution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier } from '../core/model.ts';
import type { Situation } from '../core/situation.ts';
import type { Univers } from '../core/univers.ts';
import type { Profil } from '../demo/donnees.ts';
import { Alertes, QUAND_DEFAUT, SUJETS, SUJETS_DEFAUT, VERSION_WHATSAPP, type SourcesAlertes } from './alertes.ts';
import { ErreurApi } from './monde.ts';
import { chiffreurEphemere } from './stockage.ts';

const ADMIN: Profil = { id: 'dirigeante', nom: 'Dirigeante', role: 'dirigeant', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous', peutPreparer: true, peutApprouver: true, voitScore: true, peutAdministrer: true, voitMotifsAbsence: true };
const SIMPLE: Profil = { ...ADMIN, id: 'terrain', peutAdministrer: false };

// jetons fabriqués ici, jamais réels
const JETON = `${'1'.repeat(9)}:${'A'.repeat(35)}`;
const JETON_META = `EA${'b'.repeat(40)}`;

const SOURCE = { id: 'saisie', libelle: 'Saisie', derniereSynchro: null };
const objet = (id: string, type: string, nom: string, champs: Record<string, unknown> = {}): ObjetMetier => ({
  id, orgId: 'org', famille: type === 'article' ? 'ressource' : 'commande', type, roles: [], nom,
  champs: champs as ObjetMetier['champs'], provenance: 'declare', source: SOURCE, majLe: '2026-11-10T08:00:00.000Z',
  disponibilite: 'disponible', mode: 'reel',
});
const situation = (objetId: string, regle: string, description: string, gravite: Situation['gravite'] = 'attention'): Situation => ({
  objetId, regle, description, gravite, statut: 'ouverte', responsable: null,
  preuve: { valeur: 1, seuil: 0, source: SOURCE, observeLe: '2026-11-10T08:00:00.000Z', provenance: 'declare', fraicheur: 'fraiche' },
});

const UNIVERS = {
  regles: [{ id: 'retard_paiement', libelle: 'Retard de paiement', type: 'facture', champ: 'retard', sens: 'max', seuil: 0, unite: 'jours' },
    { id: 'stock_minimum', libelle: 'Stock', type: 'article', champ: 'quantite', sens: 'min', seuil: 10 }],
  echeances: [{ id: 'controle_technique', libelle: 'Contrôle technique', type: 'vehicule', champ: 'controle_technique', avantJours: 30 }],
} as unknown as Univers;

/** Le monde simulé : ce que le module lit, et une horloge qu'on avance à la main. */
function monde() {
  const m = {
    le: new Date('2026-11-10T10:00:00'), // mardi, 10 h : dans la fenêtre d'envoi
    objets: [] as ObjetMetier[],
    situations: [] as Situation[],
    connecteurs: [] as { nom: string; message: string | null }[],
    reseau: null as number | null,
  };
  const src: SourcesAlertes = {
    maintenant: () => m.le,
    objets: () => m.objets,
    situations: () => m.situations,
    univers: () => UNIVERS,
    connecteursEnErreur: () => m.connecteurs,
    reseau: async () => m.reseau,
  };
  return { m, src };
}

/** Le service simulé : Telegram, Meta et un webhook à soi. */
function service() {
  const appels: { url: URL; methode: string; corps: Record<string, unknown>; auth: string | null }[] = [];
  const S = {
    appels,
    jetonBon: JETON,
    updates: [{ update_id: 1, message: { chat: { id: 4242, type: 'private', first_name: 'Gaël' } } }] as unknown[],
    webhookPose: false,
    /** Faire échouer Telegram : { statut, corps } ; null = tout va bien. */
    panneTelegram: null as null | { statut: number; corps: unknown },
    panneMeta: null as null | { statut: number; corps: unknown },
    panneWebhook: false,
    envois: [] as string[],
  };
  const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    const methode = init?.method ?? 'GET';
    const corps = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const entetes = new Headers(init?.headers);
    appels.push({ url: u, methode, corps, auth: entetes.get('authorization') ?? entetes.get('x-lb-signature') });
    if (u.hostname === 'api.telegram.org') {
      const [, jeton, action] = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname) ?? [];
      if (jeton !== S.jetonBon) return json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);
      if (S.panneTelegram) return json(S.panneTelegram.corps, S.panneTelegram.statut);
      if (action === 'getMe') return json({ ok: true, result: { id: 1, is_bot: true, first_name: 'Robot du port', username: 'robot_du_port_bot' } });
      if (action === 'getUpdates') {
        if (S.webhookPose) return json({ ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active' }, 409);
        return json({ ok: true, result: S.updates });
      }
      if (action === 'sendMessage') { S.envois.push(String(corps.text)); return json({ ok: true, result: { message_id: 7 } }); }
      return json({ ok: false, description: 'Not Found' }, 404);
    }
    if (u.hostname === 'graph.facebook.com') {
      if (S.panneMeta) return json(S.panneMeta.corps, S.panneMeta.statut);
      S.envois.push(JSON.stringify(corps));
      return json({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.TEST' }] });
    }
    if (S.panneWebhook) return json({ erreur: 'indisponible' }, 503);
    S.envois.push(String(corps.texte));
    return json({ ok: true });
  }) as typeof fetch;
  return { S, f };
}

function alertes(o: { service?: ReturnType<typeof service>; monde?: ReturnType<typeof monde> } = {}) {
  const s = o.service ?? service();
  const w = o.monde ?? monde();
  let changements = 0;
  const a = new Alertes(w.src, chiffreurEphemere(), { fetch: s.f, changement: () => { changements++; } });
  return { a, ...s, ...w, nb: () => changements };
}

/** Branche un canal Telegram comme l'écran le fait : jeton, conversation, enregistrement. */
async function brancherTelegram(x: Awaited<ReturnType<typeof alertes>>) {
  const r = await x.a.robotTelegram(ADMIN, { jeton: JETON });
  const c = await x.a.conversationTelegram(ADMIN, { ref: r.ref });
  assert.equal(c.trouve, true);
  return x.a.ajouterCanal(ADMIN, { canal: 'telegram', ref: r.ref });
}

// ---------------------------------------------------------------- rien d'obligatoire

test('alertes : sans canal branché, le jeu ne change pas d’un pouce', async () => {
  const x = alertes();
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours', 'critique')];
  x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 })];
  assert.equal(x.a.actif(), false);
  assert.equal(await x.a.passer(), 0);
  assert.equal(x.S.appels.length, 0, 'aucun appel sortant');
  assert.deepEqual(x.a.instantane().attente, []);
});

test('alertes : les réglages sont réservés aux administrateurs', () => {
  const x = alertes();
  assert.throws(() => x.a.reglages(SIMPLE), (e: unknown) => e instanceof ErreurApi && e.statut === 403);
  assert.throws(() => x.a.regler(SIMPLE, { sujets: [] }), (e: unknown) => e instanceof ErreurApi && e.statut === 403);
});

// ---------------------------------------------------------------- Telegram : brancher en trois étapes

test('Telegram : jeton vérifié, conversation retrouvée, canal branché', async () => {
  const x = alertes();
  const r = await x.a.robotTelegram(ADMIN, { jeton: JETON });
  assert.equal(r.robot, 'robot_du_port_bot');
  assert.equal(r.lien, 'https://t.me/robot_du_port_bot');
  assert.match(r.ref, /^telegram:[A-Za-z0-9_-]{22}$/);
  assert.equal(x.S.appels[0]?.url.pathname, `/bot${JETON}/getMe`);

  const c = await x.a.conversationTelegram(ADMIN, { ref: r.ref });
  assert.equal(c.trouve, true);
  assert.equal(c.trouve === true ? c.conversation : '', 'Gaël');

  const canal = x.a.ajouterCanal(ADMIN, { canal: 'telegram', ref: r.ref });
  assert.equal(canal.canal, 'telegram');
  assert.equal(canal.resume, '@robot_du_port_bot → Gaël');
  assert.equal(canal.actif, true);
  assert.equal(x.a.actif(), true);
});

test('Telegram : un jeton mal recopié est refusé avant tout appel', async () => {
  const x = alertes();
  await assert.rejects(() => x.a.robotTelegram(ADMIN, { jeton: 'ceci-n-est-pas-un-jeton' }),
    (e: unknown) => e instanceof ErreurApi && e.statut === 400 && /BotFather/.test(e.message));
  assert.equal(x.S.appels.length, 0);
});

test('Telegram : un jeton refusé par Telegram est dit franchement, rien n’est enregistré', async () => {
  const x = alertes();
  x.S.jetonBon = `${'9'.repeat(9)}:${'Z'.repeat(35)}`;
  await assert.rejects(() => x.a.robotTelegram(ADMIN, { jeton: JETON }),
    (e: unknown) => e instanceof ErreurApi && e.statut === 422 && /Unauthorized/.test(e.message));
  assert.equal(x.a.reglages(ADMIN).canaux.length, 0);
});

test('Telegram : tant que la personne n’a pas écrit, on le lui dit sans échouer', async () => {
  const x = alertes();
  x.S.updates = [];
  const r = await x.a.robotTelegram(ADMIN, { jeton: JETON });
  const c = await x.a.conversationTelegram(ADMIN, { ref: r.ref });
  assert.equal(c.trouve, false);
  assert.match(c.trouve === false ? c.message : '', /écrivez n’importe quel message à @robot_du_port_bot/);
  assert.throws(() => x.a.ajouterCanal(ADMIN, { canal: 'telegram', ref: r.ref }),
    (e: unknown) => e instanceof ErreurApi && e.statut === 400);
});

test('Telegram : un robot déjà relié ailleurs (webhook) est expliqué, pas bricolé', async () => {
  const x = alertes();
  x.S.webhookPose = true;
  const r = await x.a.robotTelegram(ADMIN, { jeton: JETON });
  await assert.rejects(() => x.a.conversationTelegram(ADMIN, { ref: r.ref }),
    (e: unknown) => e instanceof ErreurApi && e.code === 'robot_deja_pris' && /deuxième avec BotFather/.test(e.message));
  // le jeu ne supprime JAMAIS le webhook d'un autre logiciel
  assert.equal(x.S.appels.filter((a) => a.url.pathname.endsWith('/deleteWebhook')).length, 0);
});

// ---------------------------------------------------------------- message d'essai

test('essai : dit que c’est parti, et pourquoi quand ça rate', async () => {
  const x = alertes();
  const canal = await brancherTelegram(x);
  const ok = await x.a.essai(ADMIN, canal.id);
  assert.equal(ok.ok, true);
  assert.match(x.S.envois[0] ?? '', /Message d’essai de Living Business/);
  assert.equal(ok.canal.statut, 'ok');

  x.S.panneTelegram = { statut: 403, corps: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } };
  const ko = await x.a.essai(ADMIN, canal.id);
  assert.equal(ko.ok, false);
  assert.match(ko.message, /bloqué dans Telegram/);
  assert.equal(ko.canal.actif, false, 'erreur définitive : le canal se met en pause');
  assert.match(ko.canal.message ?? '', /en pause/);
});

test('essai : le lien du jeu accompagne le message quand l’adresse est connue', async () => {
  const x = alertes();
  const canal = await brancherTelegram(x);
  x.a.regler(ADMIN, { adresseJeu: 'https://jeu.exemple.fr/reglages' });
  assert.equal(x.a.reglages(ADMIN).adresseJeu, 'https://jeu.exemple.fr');
  await x.a.essai(ADMIN, canal.id);
  assert.match(x.S.envois.at(-1) ?? '', /https:\/\/jeu\.exemple\.fr\//);
  assert.throws(() => x.a.regler(ADMIN, { adresseJeu: 'http://jeu.exemple.fr' }),
    (e: unknown) => e instanceof ErreurApi && e.code === 'adresse_invalide');
});

// ---------------------------------------------------------------- filtres

test('filtres : seuls les sujets cochés partent, et trois seulement sont cochés au départ', async () => {
  assert.deepEqual([...SUJETS_DEFAUT], ['facture_retard', 'echeance', 'erreur_synchro']);
  assert.equal(SUJETS.filter((s) => s.defaut).length, 3, 'on ne noie personne dès le premier jour');
  const x = alertes();
  await brancherTelegram(x);
  x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 }), objet('a1', 'article', 'Panneau 19 mm', { quantite: 4 })];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours'), situation('a1', 'stock_minimum', 'Stock : 4 (minimum 10)')];

  assert.equal(await x.a.passer(), 1);
  assert.equal(x.S.envois.length, 1);
  assert.match(x.S.envois[0] ?? '', /F-2043 — Retard de paiement : 42 jours, 1/);
  assert.match(x.S.envois[0] ?? '', /À relancer\./);
  assert.doesNotMatch(x.S.envois[0] ?? '', /Panneau/, 'stock décoché : rien');

  x.a.regler(ADMIN, { sujets: [...SUJETS_DEFAUT, 'stock_bas'] });
  assert.equal(await x.a.passer(), 1);
  assert.match(x.S.envois[1] ?? '', /Panneau 19 mm — Stock : 4 \(minimum 10\)\. À commander\./);
});

test('filtres : un sujet inconnu est refusé', () => {
  const x = alertes();
  assert.throws(() => x.a.regler(ADMIN, { sujets: ['tout'] }), (e: unknown) => e instanceof ErreurApi && e.code === 'sujets_invalides');
});

test('anti-doublon : la même chose n’est pas redite, et revient si elle revient', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 })];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  assert.equal(await x.a.passer(), 1);
  assert.equal(await x.a.passer(), 0, 'rien de nouveau : rien ne part');
  assert.equal(x.S.envois.length, 1);

  x.m.situations = []; // facture payée
  await x.a.passer();
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 3 jours')]; // elle repart en retard
  assert.equal(await x.a.passer(), 1);
  assert.equal(x.S.envois.length, 2);
});

test('message : rien de sensible au-delà du nécessaire, et un lien vers le bon écran', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { adresseJeu: 'https://jeu.exemple.fr' });
  x.m.objets = [objet('t1', 'tiers', 'Menuiserie du Port', { email: 'contact@exemple.fr', telephone: '0298000000', siret: '12345678900011' }),
    objet('f1', 'facture', 'F-2043', { montant: 1450, tiers: 't1' })];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  await x.a.passer();
  const envoi = x.S.envois[0] ?? '';
  assert.match(envoi, /F-2043 \(Menuiserie du Port\)/);
  assert.doesNotMatch(envoi, /contact@exemple\.fr|0298000000|12345678900011/, 'ni e-mail, ni téléphone, ni SIRET');
  assert.match(envoi, /https:\/\/jeu\.exemple\.fr\/#\/type:facture$/);
});

test('erreur de synchronisation et demande du réseau deviennent des phrases utiles', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { sujets: ['erreur_synchro', 'demande_reseau'] });
  x.m.connecteurs = [{ nom: 'Airtable', message: 'Accès refusé : vérifiez le jeton et ses droits.' }];
  x.m.reseau = 2;
  await x.a.passer();
  const envoi = x.S.envois[0] ?? '';
  assert.match(envoi, /Synchronisation : Airtable ne répond plus \(Accès refusé/);
  assert.match(envoi, /Réseau : 2\sdemandes attendent votre réponse/);
});

// ---------------------------------------------------------------- quand

test('heures de silence : rien avant 8 h, rien après 19 h, rien le week-end', async () => {
  /** Une facture en retard, et une horloge posée à l'heure donnée. */
  const a = async (le: string) => {
    const x = alertes();
    await brancherTelegram(x);
    x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 })];
    x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
    x.m.le = new Date(le);
    return x;
  };
  const tot = await a('2026-11-10T06:30:00'); // mardi, trop tôt
  assert.equal(await tot.a.passer(), 0);
  assert.equal(tot.a.reglages(ADMIN).enAttente, 1, 'la chose attend, elle n’est pas perdue');
  tot.m.le = new Date('2026-11-10T09:00:00'); // la fenêtre s'ouvre : tout part
  assert.equal(await tot.a.passer(), 1);
  assert.equal(tot.a.reglages(ADMIN).enAttente, 0);

  const tard = await a('2026-11-10T21:00:00'); // mardi, trop tard
  assert.equal(await tard.a.passer(), 0);

  const samedi = await a('2026-11-14T10:00:00'); // samedi
  assert.equal(await samedi.a.passer(), 0);
  samedi.m.le = new Date('2026-11-16T09:00:00'); // lundi matin
  assert.equal(await samedi.a.passer(), 1);
});

test('heures de silence : le week-end peut être autorisé', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { quand: { weekEnd: true } });
  x.m.objets = [objet('f1', 'facture', 'F-2043', {})];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  x.m.le = new Date('2026-11-14T10:00:00'); // samedi
  assert.equal(await x.a.passer(), 1);
});

test('regroupement : une fois par jour, tout en un seul message à l’heure choisie', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { quand: { mode: 'une_fois_par_jour', heure: '18:00' }, sujets: [...SUJETS_DEFAUT, 'stock_bas'] });
  x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 }), objet('a1', 'article', 'Panneau 19 mm', { quantite: 4 })];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours'), situation('a1', 'stock_minimum', 'Stock : 4 (minimum 10)')];

  x.m.le = new Date('2026-11-10T10:00:00');
  assert.equal(await x.a.passer(), 0, 'avant l’heure : rien');
  assert.equal(x.a.reglages(ADMIN).enAttente, 2);

  x.m.le = new Date('2026-11-10T18:05:00');
  assert.equal(await x.a.passer(), 1);
  assert.equal(x.S.envois.length, 1, 'un seul message');
  assert.match(x.S.envois[0] ?? '', /2\schoses à regarder/);
  assert.match(x.S.envois[0] ?? '', /• F-2043/);
  assert.match(x.S.envois[0] ?? '', /• Panneau 19 mm/);
});

test('plafond : au plus tant de messages par jour, le reste part le lendemain', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { quand: { maxParJour: 1 } });
  x.m.objets = [objet('f1', 'facture', 'F-1', {})];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  assert.equal(await x.a.passer(), 1);

  x.m.objets = [...x.m.objets, objet('f2', 'facture', 'F-2', {})];
  x.m.situations = [...x.m.situations, situation('f2', 'retard_paiement', 'Retard de paiement : 9 jours')];
  assert.equal(await x.a.passer(), 0, 'plafond atteint');
  assert.equal(x.S.envois.length, 1);
  assert.equal(x.a.reglages(ADMIN).enAttente, 1);

  x.m.le = new Date('2026-11-11T10:00:00'); // le lendemain
  assert.equal(await x.a.passer(), 1);
  assert.match(x.S.envois[1] ?? '', /F-2/);
});

test('urgence : une situation critique passe malgré le silence et le plafond, et on peut le refuser', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { quand: { maxParJour: 1 } });
  x.m.le = new Date('2026-11-14T23:00:00'); // samedi, en pleine nuit
  x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 })];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 92 jours', 'critique')];
  assert.equal(await x.a.passer(), 1);
  assert.match(x.S.envois[0] ?? '', /^Urgent — F-2043/);

  // la même entreprise refuse les urgences hors des heures : plus rien ne passe la nuit
  const y = alertes();
  await brancherTelegram(y);
  y.a.regler(ADMIN, { quand: { urgencesPassent: false } });
  y.m.le = new Date('2026-11-14T23:00:00');
  y.m.objets = x.m.objets;
  y.m.situations = x.m.situations;
  assert.equal(await y.a.passer(), 0);
  assert.equal(y.a.reglages(ADMIN).enAttente, 1);
});

test('résumé du matin : une fois par jour, et il compte tout, pas seulement les sujets cochés', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { sujets: ['resume_matin'], quand: { heure: '08:30' } });
  x.m.objets = [objet('f1', 'facture', 'F-2043', { montant: 1450 }), objet('a1', 'article', 'Panneau 19 mm', { quantite: 4 })];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours'), situation('a1', 'stock_minimum', 'Stock : 4 (minimum 10)')];

  x.m.le = new Date('2026-11-10T07:00:00');
  assert.equal(await x.a.passer(), 0, 'avant l’heure');
  x.m.le = new Date('2026-11-10T08:45:00');
  assert.equal(await x.a.passer(), 1);
  assert.match(x.S.envois[0] ?? '', /^Ce matin : 2\schoses à régler\./);
  x.m.le = new Date('2026-11-10T12:00:00');
  assert.equal(await x.a.passer(), 0, 'une seule fois par jour');
});

test('réglages du quand : les valeurs fautives sont refusées en nommant le problème', () => {
  const x = alertes();
  assert.deepEqual(x.a.reglages(ADMIN).quand, { ...QUAND_DEFAUT });
  for (const [quand, code] of [
    [{ heure: '25:00' }, 'heure_invalide'],
    [{ mode: 'quand-je-veux' }, 'mode_invalide'],
    [{ maxParJour: 0 }, 'max_invalide'],
    [{ maxParJour: 999 }, 'max_invalide'],
    [{ silenceAvant: '20:00', silenceApres: '08:00' }, 'silence_invalide'],
  ] as const) {
    assert.throws(() => x.a.regler(ADMIN, { quand }), (e: unknown) => e instanceof ErreurApi && e.code === code, JSON.stringify(quand));
  }
  assert.deepEqual(x.a.reglages(ADMIN).quand, { ...QUAND_DEFAUT }, 'rien n’a bougé');
});

// ---------------------------------------------------------------- échec, reprise, pause

test('échec puis reprise : nouvel essai espacé, rien n’est perdu, rien n’inonde', async () => {
  const x = alertes();
  const canal = await brancherTelegram(x);
  x.m.objets = [objet('f1', 'facture', 'F-2043', {})];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  x.S.panneTelegram = { statut: 500, corps: { ok: false, description: 'Internal Server Error' } };

  assert.equal(await x.a.passer(), 0);
  let vue = x.a.reglages(ADMIN).canaux[0];
  assert.equal(vue?.statut, 'erreur');
  assert.equal(vue?.echecs, 1);
  assert.ok(vue?.prochainEssai, 'un nouvel essai est prévu');
  assert.equal(x.a.reglages(ADMIN).enAttente, 1);

  // tant que l'heure du nouvel essai n'est pas venue, on ne retente pas (pas d'inondation)
  const avant = x.S.appels.length;
  assert.equal(await x.a.passer(), 0);
  assert.equal(x.S.appels.length, avant, 'aucun nouvel appel avant l’heure');

  x.S.panneTelegram = null;
  x.m.le = new Date('2026-11-10T10:10:00');
  assert.equal(await x.a.passer(), 1);
  vue = x.a.reglages(ADMIN).canaux[0];
  assert.equal(vue?.statut, 'ok');
  assert.equal(vue?.echecs, 0);
  assert.equal(vue?.prochainEssai, null);
  assert.match(x.S.envois[0] ?? '', /F-2043/);
  assert.equal(canal.id, vue?.id);
});

test('pause automatique : après huit échecs d’affilée, le canal s’arrête et l’écrit', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.S.panneTelegram = { statut: 500, corps: { ok: false, description: 'Internal Server Error' } };
  for (let i = 0; i < 8; i++) {
    x.m.le = new Date(Date.parse('2026-11-10T10:00:00') + i * 24 * 3600_000 + 3600_000);
    await x.a.essai(ADMIN, x.a.reglages(ADMIN).canaux[0]?.id as string);
  }
  const vue = x.a.reglages(ADMIN).canaux[0];
  assert.equal(vue?.actif, false);
  assert.match(vue?.message ?? '', /Après 8 essais, ce canal est en pause/);
  assert.equal(x.a.actif(), false);

  // relancé à la main : les compteurs repartent de zéro
  const relance = x.a.modifierCanal(ADMIN, vue?.id, { actif: true });
  assert.equal(relance.actif, true);
  assert.equal(relance.echecs, 0);
});

test('un fait trop vieux est abandonné plutôt que d’arriver trois jours après', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.m.objets = [objet('f1', 'facture', 'F-2043', {})];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  x.m.le = new Date('2026-11-10T06:00:00'); // avant la fenêtre : la chose attend
  await x.a.passer();
  assert.equal(x.a.reglages(ADMIN).enAttente, 1);
  x.m.le = new Date('2026-11-13T06:00:00'); // trois jours plus tard
  await x.a.passer();
  assert.equal(x.a.reglages(ADMIN).enAttente, 0, 'abandonné : c’est toujours à l’écran du jeu');
  assert.equal(x.S.envois.length, 0);
});

// ---------------------------------------------------------------- WhatsApp

test('WhatsApp : un modèle approuvé part vers l’adresse officielle de Meta', async () => {
  const x = alertes();
  const canal = x.a.ajouterCanal(ADMIN, { canal: 'whatsapp', jeton: JETON_META, numeroId: '123456789012345', destinataire: '+33 6 12 34 56 78', modele: 'alerte_living_business', langue: 'fr' });
  assert.equal(canal.resume, 'WhatsApp Business → numéro finissant par 78 (modèle « alerte_living_business »)');
  const r = await x.a.essai(ADMIN, canal.id);
  assert.equal(r.ok, true);
  const appel = x.S.appels.at(-1);
  assert.equal(appel?.url.href, `https://graph.facebook.com/${VERSION_WHATSAPP}/123456789012345/messages`);
  assert.equal(appel?.auth, `Bearer ${JETON_META}`);
  assert.equal(appel?.corps.messaging_product, 'whatsapp');
  assert.equal(appel?.corps.type, 'template', 'hors des 24 h, seul un modèle approuvé passe');
  const modele = appel?.corps.template as { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] };
  assert.equal(modele.name, 'alerte_living_business');
  assert.equal(modele.language.code, 'fr');
  const parametre = modele.components[0]?.parameters[0]?.text ?? '';
  assert.doesNotMatch(parametre, /\n|\t| {2,}/, 'Meta refuse un paramètre mis en forme');
});

test('WhatsApp : les réglages manquants ou fautifs sont nommés un par un', () => {
  const x = alertes();
  const bon = { canal: 'whatsapp', jeton: JETON_META, numeroId: '123456789012345', destinataire: '+33612345678', modele: 'alerte_living_business' };
  for (const [patch, code] of [
    [{ jeton: '' }, 'jeton_manquant'],
    [{ numeroId: '+33612345678' }, 'numeroId_invalide'],
    [{ destinataire: 'mon numéro' }, 'destinataire_invalide'],
    [{ modele: 'Alerte Living Business' }, 'modele_invalide'],
    [{ langue: 'français' }, 'langue_invalide'],
  ] as const) {
    assert.throws(() => x.a.ajouterCanal(ADMIN, { ...bon, ...patch }), (e: unknown) => e instanceof ErreurApi && e.code === code, JSON.stringify(patch));
  }
  assert.equal(x.a.reglages(ADMIN).canaux.length, 0);
});

test('WhatsApp : un modèle non approuvé met le canal en pause, avec le mot de Meta', async () => {
  const x = alertes();
  const canal = x.a.ajouterCanal(ADMIN, { canal: 'whatsapp', jeton: JETON_META, numeroId: '123456789012345', destinataire: '+33612345678', modele: 'pas_approuve' });
  x.S.panneMeta = { statut: 400, corps: { error: { message: 'Template name does not exist in the translation', code: 132001, type: 'OAuthException' } } };
  const r = await x.a.essai(ADMIN, canal.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /Template name does not exist/);
  assert.equal(r.canal.actif, false, 'réessayer n’y changerait rien');
});

// ---------------------------------------------------------------- webhook à soi

test('webhook : le corps est signé, et une adresse interne est refusée (anti-SSRF)', async () => {
  const x = alertes();
  const canal = x.a.ajouterCanal(ADMIN, { canal: 'webhook', url: 'https://hook.exemple.fr/alertes', secret: 'secret-de-essai-fabrique-ici' });
  assert.equal(canal.resume, 'https://hook.exemple.fr/…');
  const r = await x.a.essai(ADMIN, canal.id);
  assert.equal(r.ok, true);
  assert.match(x.S.appels.at(-1)?.auth ?? '', /^t=\d+,v1=[0-9a-f]{64}$/);

  const interne = x.a.ajouterCanal(ADMIN, { canal: 'webhook', url: 'https://192.168.1.10/alertes' });
  const ko = await x.a.essai(ADMIN, interne.id);
  assert.equal(ko.ok, false);
  assert.match(ko.message, /interne ou privée/);
  assert.equal(ko.canal.actif, false);
});

test('webhook : pas d’identifiant dans l’adresse, et seulement une vraie adresse', () => {
  const x = alertes();
  for (const url of ['pas une adresse', 'https://robot:motdepasse@hook.exemple.fr/']) {
    assert.throws(() => x.a.ajouterCanal(ADMIN, { canal: 'webhook', url }), (e: unknown) => e instanceof ErreurApi && e.code === 'url_invalide', url);
  }
});

// ---------------------------------------------------------------- secrets

test('secrets : chiffrés au repos, jamais renvoyés à l’écran, jamais écrits dans un journal', async () => {
  const x = alertes();
  const canal = await brancherTelegram(x);
  const etat = JSON.stringify(x.a.instantane());
  assert.doesNotMatch(etat, new RegExp(JETON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'le jeton n’est pas en clair dans l’état');
  assert.match(etat, /"prive":"v1\./, 'il est chiffré comme les autres secrets');
  assert.doesNotMatch(JSON.stringify(x.a.reglages(ADMIN)), /A{10}/, 'rien du jeton ne part vers le navigateur');
  assert.equal((canal as Record<string, unknown>).prive, undefined);

  // une erreur qui contiendrait le jeton est nettoyée avant d'être notée
  x.S.panneTelegram = { statut: 400, corps: { ok: false, description: `Bad Request near ${JETON}` } };
  const r = await x.a.essai(ADMIN, canal.id);
  assert.equal(r.ok, false);
  assert.doesNotMatch(JSON.stringify(x.a.reglages(ADMIN).canaux), new RegExp('A{10}'), 'le journal ne porte pas le jeton');
});

test('relecture : un état enregistré revient tel quel, un canal illisible est écarté', async () => {
  const x = alertes();
  await brancherTelegram(x);
  x.a.regler(ADMIN, { sujets: ['stock_bas'], quand: { mode: 'une_fois_par_jour', heure: '17:00' } });
  const etat = JSON.parse(JSON.stringify(x.a.instantane())) as ReturnType<Alertes['instantane']>;
  const relu = new Alertes(monde().src, chiffreurEphemere(), { etat });
  assert.deepEqual(relu.reglages(ADMIN).sujets.filter((s) => s.choisi).map((s) => s.id), ['stock_bas']);
  assert.equal(relu.reglages(ADMIN).quand.heure, '17:00');
  assert.equal(relu.reglages(ADMIN).canaux.length, 1);

  const casse = { ...etat, canaux: [{ ...etat.canaux[0], id: 'pas-un-id' }] } as unknown as ReturnType<Alertes['instantane']>;
  assert.equal(new Alertes(monde().src, chiffreurEphemere(), { etat: casse }).reglages(ADMIN).canaux.length, 0);
});

test('supprimer un canal arrête tout de suite les envois', async () => {
  const x = alertes();
  const canal = await brancherTelegram(x);
  assert.deepEqual(x.a.supprimerCanal(ADMIN, canal.id), { ok: true, id: canal.id });
  assert.equal(x.a.actif(), false);
  x.m.objets = [objet('f1', 'facture', 'F-2043', {})];
  x.m.situations = [situation('f1', 'retard_paiement', 'Retard de paiement : 42 jours')];
  assert.equal(await x.a.passer(), 0);
  assert.equal(x.S.envois.length, 0);
  await assert.rejects(() => x.a.essai(ADMIN, canal.id), (e: unknown) => e instanceof ErreurApi && e.statut === 404);
});
